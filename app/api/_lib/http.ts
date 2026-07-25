import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * ============================================================
 * 职见未来 · serverless functions 共享 HTTP 工具
 * ============================================================
 * 同时服务于两套宿主（同一套约定，行为一致）：
 *   - vite dev 中间件（vite-plugins/*.ts，Node http 原生 req/res）
 *   - Vercel serverless functions（api/*.ts，req/res 兼容 Node http）
 * 不依赖 @vercel/node 类型包，避免引入额外 npm 依赖。
 * ============================================================
 */

/** 读取请求体（utf8 文本，带大小上限；超限 reject 'body too large'） */
export function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8')
      if (data.length > maxBytes) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/** 读取请求体（原始 Buffer，带大小上限；代理类接口透传用） */
export function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      size += chunk.length
      if (size > maxBytes) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** JSON 响应（utf8） */
export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
