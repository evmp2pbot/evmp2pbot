/* eslint-disable @typescript-eslint/no-floating-promises */
import { EventHandler } from '.';
import { IOrder } from '../../../models/order';
import * as Events from './index';

const TYPES = {
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_TAKEN: 'ORDER_TAKEN',
};
export { TYPES };

export const orderCreated = (order: IOrder) => {
  Events.dispatch({
    type: TYPES.ORDER_CREATED,
    payload: order,
  });
};
export const onOrderCreated = (fn: EventHandler) =>
  Events.subscribe(TYPES.ORDER_CREATED, fn);

export const orderTaken = (order: IOrder) => {
  Events.dispatch({
    type: TYPES.ORDER_TAKEN,
    payload: order,
  });
};
export const onOrderTaken = (fn: EventHandler) =>
  Events.subscribe(TYPES.ORDER_TAKEN, fn);
