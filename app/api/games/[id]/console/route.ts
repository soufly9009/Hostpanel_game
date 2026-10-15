import { getAccessibleGame } from "@/lib/games/access"
import { subscribeConsole } from "@/lib/pterodactyl/console"

export const dynamic = "force-dynamic"

/** Flux SSE de la console (le websocket Wings reste côté serveur). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const access = await getAccessibleGame(id)
  if (!access || access.game.suspended) {
    return new Response("Not found", { status: 404 })
  }

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let keepAlive: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: string) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          )
        } catch {
          // flux fermé
        }
      }
      const finish = () => {
        if (keepAlive) clearInterval(keepAlive)
        unsubscribe?.()
        try {
          controller.close()
        } catch {
          // déjà fermé
        }
      }
      unsubscribe = subscribeConsole(access.game, (e) => {
        if (e.type === "reset") send("reset", "")
        else send(e.type, e.data)
      })
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"))
        } catch {
          finish()
        }
      }, 20_000)
      request.signal.addEventListener("abort", finish)
    },
    cancel() {
      if (keepAlive) clearInterval(keepAlive)
      unsubscribe?.()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
