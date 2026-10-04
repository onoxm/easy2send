import type { PromiseToastOptionsType, ToastProps } from 'ono-react-element'
import { toast } from 'ono-react-element'

const className = 'bg-surface-base text-ink-900 border border-line-200'

const formatOptions = (options: string | ToastProps) => {
  if (typeof options === 'string') {
    return { message: options, className }
  }
  return Object.assign({ className }, options)
}

export const innerToast: typeof toast = {
  success: options => toast.success(formatOptions(options)),
  error: options => toast.error(formatOptions(options)),
  warning: options => toast.warning(formatOptions(options)),
  promise: (promise, options) =>
    toast.promise(
      promise,
      Object.assign({ className }, options) as PromiseToastOptionsType
    )
}
