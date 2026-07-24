declare global {
    namespace NodeJS {
        interface ProcessEnv {
            readonly IS_DEV?: "true";
        }
    }
}

export { };