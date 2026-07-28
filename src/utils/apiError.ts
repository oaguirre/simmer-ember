class ApiError {
  code: number
  message: string
  from: string
  params: Record<string, any> | undefined

  constructor (code: number, message: string, from: string, params?: Record<string, any>) {
    this.code = code
    this.message = message
    this.from = from
    this.params = params
  }

  static forbidden (msg: string, from: string, params?: Record<string, any>) {
    return new ApiError(403, msg, from, params)
  }

  static unauthorized (msg: string, from: string, params?: Record<string, any>) {
    return new ApiError(401, msg, from, params)
  }

  static badRequest (msg: string, from: string, params?: Record<string, any>) {
    return new ApiError(400, msg, from, params)
  }

  static notFound (msg: string, from: string, params?: Record<string, any>) {
    return new ApiError(404, msg, from, params)
  }

  static internal (msg: string, from: string) {
    return new ApiError(500, msg, from)
  }
}

export default ApiError
