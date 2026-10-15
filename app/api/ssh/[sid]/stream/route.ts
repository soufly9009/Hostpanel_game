import { getCurrentUser } from "@/lib/auth/session"
import { getSession, subscribe } from "@/lib/ssh/sessions"

export const dynamic = "force-dynamic"

/** Flux SSE de la sortie du terminal (octets encodés en base64). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sid: string }> }
) {
  const user = await getCurrentUser()
  const { sid } = await params
  const session = user ? getSession(sid, user.id) : null
  if (!session) return new Response("Session introuvable", { status: 404 })

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let keepAlive: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          // flux déjà fermé
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

      unsubscribe = subscribe(session, (chunk) => {
        if (chunk === null) {
          send("event: close\ndata: closed\n\n")
          finish()
        } else {
          send(`data: ${chunk.toString("base64")}\n\n`)
        }
      })

      keepAlive = setInterval(() => send(": keep-alive\n\n"), 20_000)
      request.signal.addEventListener("abort", finish)
      send(": ouvert\n\n")
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
