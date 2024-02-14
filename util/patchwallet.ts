import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const PATCHWALLET_API_BASE = 'https://paymagicapi.com/v1/';

const secretClient = new SecretManagerServiceClient();
async function getSecretVersion(secretName: string): Promise<string | null> {
  try {
    const [version] = await secretClient.accessSecretVersion({
      name: secretName,
    });

    // Extract the secret's content
    const secretValue = version?.payload?.data?.toString();
    return secretValue || '';
  } catch (err) {
    console.error(`Error retrieving the secret: ${err}`);
    return null; // Returns null in case of an error
  }
}

function lazyMemo<T>(
  refreshMs: number,
  invalidMs: number,
  getter: () => Promise<T>
): () => Promise<T> {
  let ts = 0;
  let value: T;
  async function refresh() {
    value = await getter();
    ts = Date.now();
    return value;
  }
  return async () => {
    if (Date.now() > ts + invalidMs) {
      return await refresh();
    }
    if (Date.now() > ts + refreshMs) {
      refresh().catch(() => {
        ts = 0; // Retry on next access, throw at that time if still error
      });
    }
    return value;
  };
}
const ensureEnv = (key: string) => {
  const ret = process.env[key];
  if (!ret) {
    console.error('Error: Environment variable not set:', key);
    setTimeout(() => process.exit(1), 0); // Check more variables before exiting
    return '';
  }
  return ret;
};
const SECRET_PATCHWALLET_CLIENT_ID = ensureEnv('SECRET_PATCHWALLET_CLIENT_ID');
const SECRET_PATCHWALLET_CLIENT_SECRET = ensureEnv(
  'SECRET_PATCHWALLET_CLIENT_SECRET'
);
const getClientId = lazyMemo(60000, 86400 * 7 * 1000, () =>
  getSecretVersion(SECRET_PATCHWALLET_CLIENT_ID)
);
const getClientSecret = lazyMemo(60000, 86400 * 7 * 1000, () =>
  getSecretVersion(SECRET_PATCHWALLET_CLIENT_SECRET)
);

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
export async function getAddressFromSecret(secret: string) {
  return (
    await pwApi<{ users: { accountAddress: string }[] }>('resolver', {
      userIds: `${PATCHWALLET_ID_PREFIX}${secret}`,
    })
  ).users[0].accountAddress;
}
