import { isAddress } from 'ethers';

// {
//	pr: String, // bech32-serialized lightning invoice
//	routes: [], // an empty array
// }
const resolvLightningAddress = async (address: string, amountMsat: string) => {
  if (!isAddress(address)) {
    return null;
  }
  return {
    pr: `EVMTODO: Create invoice here (${amountMsat})`,
    routes: [],
  };
};

export { resolvLightningAddress };
