import router from "./router"

export default {
  async fetch(request, env, ctx) {
    return router.handle(request, env, ctx)
  }
}