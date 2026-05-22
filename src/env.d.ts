declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production'
  }
}

declare const process: { env: NodeJS.ProcessEnv }
