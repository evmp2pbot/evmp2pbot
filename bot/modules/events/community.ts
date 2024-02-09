import { ICommunity } from '../../../models/community';
import * as Events from './index';

export const TYPES = {
  COMMUNITY_UPDATED: 'COMMUNITY_UPDATED',
};

export const communityUpdated = (community: ICommunity) => {
  Events.dispatch({
    type: TYPES.COMMUNITY_UPDATED,
    payload: community,
  });
};
export const onCommunityUpdated = (fn: Events.EventHandler) =>
  Events.subscribe(TYPES.COMMUNITY_UPDATED, fn);
