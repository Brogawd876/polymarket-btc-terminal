declare module '*?inline' {
  const content: string;
  export default content;
}

declare module 'wxt/sandbox' {
  export function defineBackground(cb: any): any;
  export function defineContentScript(options: any): any;
  export function defineUnlistedScript(cb: any): any;
}

declare module 'wxt/client' {
  export function createShadowRootUi(ctx: any, options: any): any;
}
