import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { DotenvPopulateInput, parse, populate } from 'dotenv';

async function main() {
  const secretClient = new SecretManagerServiceClient();
  const [version] = await secretClient.accessSecretVersion({
    name: process.env.DOTENV_SECRET,
  });

  // Extract the secret's content
  const secretValue = version?.payload?.data?.toString();
  if (!secretValue) {
    throw new Error('Got invalid result for dotenv secret');
  }
  populate(process.env as DotenvPopulateInput, parse(secretValue), {
    override: true,
  });
  require('./app');
}

main().catch(e => {
  console.error(e.toString());
  console.error(e.stack);
  process.exit(1);
});
