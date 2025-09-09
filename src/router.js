import { Router } from '@tsndr/cloudflare-worker-router'

const router = new Router()

router.get('/api/assets', async ({ env, req }) => {
  try {
    // Support both router-provided `req.query` and raw Request URL search params
    const query = (req && req.query) ? req.query : Object.fromEntries(new URL(req.url).searchParams)
    const platform = query.platform ?? null
    const arch = query.arch ?? null

    // Programmatic valid keys (easy to extend)
    const validKeys = [ 'windows-x64', 'windows-x86', 'linux-x64', 'macos-arm64' ]

    if (!platform || !arch || !validKeys.includes(`${platform}-${arch}`)) {
      return new Response(JSON.stringify({ error: 'Missing or invalid platform or arch query parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const key = `${platform}-${arch}`
    const jsonPath = `libs/${key}.json`

    // Try to read the cached list
    const cached = await env.BLOCKGAME_ASSETS.get(jsonPath)

    if (cached) {
      // cached can be a string (KV) or an object with a body (R2). Handle both.
      const headers = new Headers({ 'Content-Type': 'application/json' })
      // Cache-control: allow CDNs / browsers to cache for some time (adjust as appropriate)
      headers.set('Cache-Control', 'public, max-age=3600')

      // R2 returns an object with .body (ReadableStream). Prefer returning the stream directly.
      console.log(`Serving cached asset list (R2) for ${key}`)
      return new Response(cached.body, { headers })
    }

    console.log(`Generating new asset list for ${key}`)

    // List common + native libs in parallel
    const [commonList, nativeList] = await Promise.all([
      env.BLOCKGAME_ASSETS.list({ prefix: 'libs/common/' }),
      env.BLOCKGAME_ASSETS.list({ prefix: `libs/${key}/` })
    ])

    // `objects` may not exist for some implementations; fallback to empty array
    const commonObjects = (commonList && commonList.objects) || []
    const nativeObjects = (nativeList && nativeList.objects) || []

    // Combine without creating intermediate arrays if possible
    const combined = [...commonObjects, ...nativeObjects]

    const newAssetList = combined
      // Filter out "directory" entries (some stores list folders as keys ending with '/')
      .filter(obj => obj && obj.key && !obj.key.endsWith('/'))
      .map(obj => {
        const name = obj.key.split('/').pop()
        const url = `https://assets.blockgame.james090500.com/${obj.key}`
        return { name, url }
      })

    const responseBody = JSON.stringify(newAssetList)

    await env.BLOCKGAME_ASSETS.put(jsonPath, responseBody, { httpMetadata: { contentType: 'application/json' } })

    return new Response(responseBody, { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('Failed to build asset list:', err)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

export default router
