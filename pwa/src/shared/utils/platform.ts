export function isAndroid(ua: string = navigator.userAgent): boolean {
  return /\bAndroid\b/i.test(ua);
}
