import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { ensureEnv, lazyMemo } from '.';
import { TOKEN_CONTRACT, encodeTransferTx } from '../ln/evm';
import { logger } from '../logger';

const PATCHWALLET_API_BASE = 'https://paymagicapi.com/v1/';

const secretClient = new SecretManagerServiceClient();
const alreadyEmittedWarning = new Set<string>();
async function getSecretVersion(envName: string): Promise<string | null> {
  const secretName = ensureEnv(envName);
  if (!/^projects\/\d+\/secrets\/.*/.test(secretName)) {
    if (process.env.NODE_ENV !== 'production') {
      if (!alreadyEmittedWarning.has(envName)) {
        logger.warning(
          `Using environment variable ${envName} as secret directly`
        );
        alreadyEmittedWarning.add(envName);
      }
      return secretName;
    }
    throw new Error(`Invalid secret path: ${envName}`);
  }
  const [version] = await secretClient.accessSecretVersion({
    name: secretName,
  });

  // Extract the secret's content
  const secretValue = version?.payload?.data?.toString();
  if (!secretValue) {
    throw new Error(`Got invalid result for secret ${envName}`);
  }
  return secretValue;
}

ensureEnv('SECRET_PATCHWALLET_CLIENT_ID');
ensureEnv('SECRET_PATCHWALLET_CLIENT_SECRET');
const getClientId = lazyMemo(60000, 86400 * 7 * 1000, () =>
  getSecretVersion('SECRET_PATCHWALLET_CLIENT_ID')
);
const getClientSecret = lazyMemo(60000, 86400 * 7 * 1000, () =>
  getSecretVersion('SECRET_PATCHWALLET_CLIENT_SECRET')
);
const failFast = (f: () => Promise<unknown>) =>
  f().catch(e => {
    console.error(e?.toString());
    setTimeout(() => process.exit(1), 1000).unref();
    return Promise.reject(e);
  });

async function pwRawApi<TResult = unknown, TConfig = unknown>(
  path: string,
  data?: unknown,
  config?: AxiosRequestConfig<TConfig>
): Promise<AxiosResponse<TResult>> {
  config = config || {};
  return axios({
    url: `${PATCHWALLET_API_BASE}${path}`,
    data,
    method: config.method ?? (data ? 'post' : 'get'),
    timeout: 100000,
    ...config,
  });
}

const getAccessToken = lazyMemo(
  15000,
  30000,
  async () =>
    (
      await pwRawApi<{ access_token: string }>('auth', {
        client_id: await getClientId(),
        client_secret: await getClientSecret(),
      })
    ).data.access_token
);

// Fail early if any setting is incorrect
Promise.all([failFast(getClientId), failFast(getClientSecret)])
  .then(() => failFast(getAccessToken))
  .catch();

const pwApi = async <TResult = unknown, TConfig = unknown>(
  path: string,
  data?: unknown,
  config?: AxiosRequestConfig<TConfig>
): Promise<TResult> =>
  (
    await pwRawApi<TResult>(path, data, {
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
        ...(data
          ? {
              'Content-Type': 'application/json',
            }
          : {}),
        ...(config?.headers || {}),
      },
      ...(config || {}),
    })
  ).data;

const PATCHWALLET_ID_PREFIX = ensureEnv('PATCHWALLET_ID_PREFIX');
const PATCHWALLET_CHAIN_NAME = ensureEnv('PATCHWALLET_CHAIN_NAME');
const addressCache = new Map<string, string>();
export async function getAddressFromSecret(secret: string) {
  if (addressCache.has(secret)) {
    return addressCache.get(secret);
  }
  const result = (
    await pwApi<{ users: { accountAddress: string }[] }>('resolver', {
      userIds: `${PATCHWALLET_ID_PREFIX}${secret}`,
    })
  ).users[0].accountAddress;
  if (addressCache.size > 200) {
    for (const key of addressCache.keys()) {
      addressCache.delete(key);
      if (addressCache.size < 100) {
        break;
      }
    }
  }
  addressCache.set(secret, result);
  return result;
}

async function sendTx({
  secret,
  to,
  value = '0x0',
  data,
  delegatecall = 0,
}: {
  secret: string;
  to: string;
  value?: string;
  data: string;
  delegatecall?: 0 | 1;
}) {
  return await pwApi<{ userOpHash: string; txHash?: string }>('kernel/tx', {
    userId: `${PATCHWALLET_ID_PREFIX}${secret}`,
    chain: PATCHWALLET_CHAIN_NAME,
    to: [to],
    value: [value],
    data: [data],
    delegatecall,
    auth: '',
  }).then(result => {
    logger.debug('tx result: ' + JSON.stringify(result));
    return result;
  });
}

export async function transferToken({
  secret,
  to,
  amount,
}: {
  secret: string;
  to: string;
  amount: bigint;
}) {
  return await sendTx({
    secret,
    to: TOKEN_CONTRACT,
    data: await encodeTransferTx(to, amount),
  });
}
