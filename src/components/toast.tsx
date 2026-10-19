import type { PromiseToastOptionsType, ToastProps } from 'ono-react-element'
import { toast as innerToast } from 'ono-react-element'

const className = 'bg-surface-base text-ink-900 border border-line-200'

const formatOptions = (options: string | ToastProps) => {
  if (typeof options === 'string') {
    return { message: options, className }
  }
  return Object.assign({ className }, options)
}

export const toast: typeof innerToast = {
  success: options => innerToast.success(formatOptions(options)),
  error: options => innerToast.error(formatOptions(options)),
  warning: options => innerToast.warning(formatOptions(options)),
  promise: (promise, options) =>
    innerToast.promise(
      promise,
      Object.assign({ className }, options) as PromiseToastOptionsType
    )
}
