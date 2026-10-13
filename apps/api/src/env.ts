export type Env = {
  APP_ENV: "local" | "staging" | "production";
  APP_VERSION: string;
};

export type Variables = {
  requestId: string;
};

export type AppBindings = { Bindings: Env; Variables: Variables };
