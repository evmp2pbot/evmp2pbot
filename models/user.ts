import mongoose, { Types, Schema } from 'mongoose';

interface UserReview {
  rating: number;
  reviewed_at: Date;
}

export interface IUser {
  tg_id: string;
  username?: string;
  lang: string;
  trades_completed: number;
  total_reviews: number;
  last_rating: number;
  total_rating: number;
  reviews: UserReview[];
  volume_traded: number;
  admin: boolean;
  banned: boolean;
  show_username: boolean;
  show_volume_traded: boolean;
  lightning_address?: string | null;
  nostr_public_key?: string;
  disputes: number;
  created_at: Date;
  extwallet_created_at?: Date;
  default_community_id?: string;
}

const UserReviewSchema = new Schema<UserReview>({
  rating: { type: Number, min: 0, max: 5, default: 0 },
  reviewed_at: { type: Date, default: Date.now },
});

const UserSchema = new Schema<IUser>({
  tg_id: { type: String, unique: true },
  username: { type: String },
  lang: { type: String, default: 'en' },
  trades_completed: { type: Number, min: 0, default: 0 },
  total_reviews: { type: Number, min: 0, default: 0 },
  last_rating: { type: Number, min: 0, max: 5, default: 0 },
  total_rating: { type: Number, min: 0, max: 5, default: 0 },
  reviews: [UserReviewSchema],
  volume_traded: { type: Number, min: 0, default: 0 },
  admin: { type: Boolean, default: false },
  banned: { type: Boolean, default: false },
  show_username: { type: Boolean, default: false },
  show_volume_traded: { type: Boolean, default: false },
  lightning_address: { type: String },
  nostr_public_key: { type: String },
  disputes: { type: Number, min: 0, default: 0 },
  created_at: { type: Date, default: Date.now },
  extwallet_created_at: { type: Date },
  default_community_id: { type: String },
});

interface IUserReview2 {
  source: Types.ObjectId;
  target: Types.ObjectId;
  rating: number;
  reviewed_at: Date;
}
const UserReview2Schema = new Schema<IUserReview2>({
  source: { type: mongoose.Schema.Types.ObjectId, required: true },
  target: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  rating: { type: Number, min: 0, max: 5, default: 0 },
  reviewed_at: { type: Date, default: Date.now },
});
UserReview2Schema.index({ source: 1, target: 1 }, { unique: true });

const Model = mongoose.model<IUser>('User', UserSchema);
export const UserReview2 = mongoose.model<IUserReview2>(
  'UserReview2',
  UserReview2Schema
);
export type UserDocument = ReturnType<typeof Model['hydrate']>;
export default Model;
