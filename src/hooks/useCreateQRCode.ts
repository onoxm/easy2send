import QRCode from 'qrcode'

export const useCreateQRCode =
  () =>
  async (
    src: string,
    options?: {
      width?: number
      margin?: number
      color?: string
      bgColor?: string
      errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
    }
  ) =>
    await QRCode.toDataURL(src, {
      width: options?.width ?? 200,
      margin: options?.margin ?? 2,
      color: {
        dark: options?.color ?? '#000000ff',
        light: options?.bgColor ?? '#ffffffff'
      },
      errorCorrectionLevel: options?.errorCorrectionLevel ?? 'H'
    })
