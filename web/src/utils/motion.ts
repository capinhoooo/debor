// Shared animation constants — benji style: 120-180ms, ease-out, blur(4px)+translateY(4px)

export const ease = [0.16, 1, 0.3, 1] as const

export const fadeIn = {
  initial: { opacity: 0, y: 4, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  transition: { duration: 0.18, ease },
}

export function stagger(i: number) {
  return { ...fadeIn, transition: { duration: 0.18, ease, delay: i * 0.04 } }
}

export function delayedFadeIn(delay: number) {
  return { ...fadeIn, transition: { duration: 0.18, ease, delay } }
}
