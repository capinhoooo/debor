interface AppConfig {
  appName: string
  appDescription: string
  links: {
    twitter: string
    github: string
    docs: string
  }
  features: {
    smoothScroll: boolean
  }
}

export const config: AppConfig = {
  appName: 'DeBOR',
  appDescription: 'Decentralized Benchmark Oracle Rate',
  links: {
    twitter: '',
    github: '',
    docs: '',
  },
  features: {
    smoothScroll: true,
  },
}
