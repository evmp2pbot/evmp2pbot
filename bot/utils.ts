import { SceneContext } from "telegraf/scenes";
import { MainContext } from "./start";

export async function safeSceneLeave(ctx: MainContext) {
  if (ctx.scene) {
    await ctx.scene.leave();
  } else if ((ctx as unknown as SceneContext).session?.__scenes) {
    (ctx as unknown as SceneContext).session.__scenes = {};
  }
}
