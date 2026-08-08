import { defineContentScript } from 'wxt/sandbox';
import { createShadowRootUi } from 'wxt/client';
import ReactDOM from 'react-dom/client';
import React from 'react';
import App from '../components/App';
import '../assets/tailwind.css';

export default defineContentScript({
  matches: ['*://*.polymarket.com/*', '*://polymarket.com/*'],
  cssInjectionMode: 'ui',
  async main(ctx: any) {
    console.log('PolyBTC Terminal: Content script injected and running!');
    const ui = await createShadowRootUi(ctx, {
      name: 'polymarket-btc-terminal',
      position: 'overlay',
      anchor: 'html',
      append: 'last',
      zIndex: 2147483647,
      onMount: (container: HTMLElement) => {
        const shadowRoot = container.getRootNode();
        if (shadowRoot instanceof ShadowRoot && shadowRoot.host instanceof HTMLElement) {
          shadowRoot.host.style.position = 'fixed';
          shadowRoot.host.style.inset = '0';
          shadowRoot.host.style.zIndex = '2147483647';
          shadowRoot.host.style.width = '100vw';
          shadowRoot.host.style.height = '100vh';
          shadowRoot.host.style.display = 'block';
          shadowRoot.host.style.pointerEvents = 'none';
        }

        const parent = container.parentElement;
        if (parent) {
          parent.style.position = 'fixed';
          parent.style.inset = '0';
          parent.style.zIndex = '2147483647';
          parent.style.width = '100vw';
          parent.style.height = '100vh';
          parent.style.display = 'block';
          parent.style.pointerEvents = 'none';
        }
        container.style.display = 'block';
        container.style.width = '100vw';
        container.style.height = '100vh';
        container.style.pointerEvents = 'none';
        const root = ReactDOM.createRoot(container);
        root.render(<App />);
        return root;
      },
      onRemove: (root: any) => {
        if (root) {
          root.unmount();
        }
      },
    });

    ui.mount();
  },
});
