declare const __PROXY_IMAGE_API__: string

declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production'
  }
}

declare const process: { env: NodeJS.ProcessEnv }
