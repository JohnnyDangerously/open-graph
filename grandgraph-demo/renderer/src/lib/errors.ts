export type Step =
  | 'STEP_1_COMMAND'      // typing / run pressed
  | 'STEP_2_EVALUATE'     // parse + intent + preview
  | 'STEP_3_BUILD_SQL'    // building SQL/params
  | 'STEP_4_FETCH'        // HTTP/ClickHouse
  | 'STEP_5_TILE'         // parse/validate tile
  | 'STEP_6_RENDER'       // scene apply/render

export type AppError = Error & {
  step: Step;
  code?: string;
  runId?: number;
  detail?: Record<string, unknown>;
  cause?: unknown;
}

export function raise(step: Step, code: string, message: string, detail?: Record<string, unknown>, cause?: unknown): never {
  const err = new Error(message) as AppError
  err.step = step
  err.code = code
  err.detail = detail
  ;(err as any).cause = cause
  throw err
}

export function wrap(step: Step, code: string, msg: string, detail?: Record<string, unknown>) {
  return (e: unknown) => raise(step, code, msg, detail, e)
}


