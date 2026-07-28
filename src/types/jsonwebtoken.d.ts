declare module 'jsonwebtoken' {
  export interface SignOptions {
    expiresIn?: string | number
    [key: string]: any
  }
  export function sign(payload: any, secret: string, options?: SignOptions): string
  export function verify(token: string, secret: string, callback: (err: any, payload: any) => void): void
  export function decode(token: string): any
}
