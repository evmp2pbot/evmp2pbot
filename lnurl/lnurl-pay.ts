import { getAddress, isAddress } from 'ethers';

// {
//	pr: String, // bech32-serialized lightning invoice
//	routes: [], // an empty array
// }
const resolvLightningAddress = async (address: string, _amountMsat: string) => {
  if (!isAddress(address)) {
    return null;
  }
  return {
    pr: getAddress(address),
    routes: [],
  };
};

export { resolvLightningAddress };
