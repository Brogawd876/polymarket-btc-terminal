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
          shadowRoot.host.style.width = '0';
          shadowRoot.host.style.height = '0';
          shadowRoot.host.style.display = 'block';
          shadowRoot.host.style.pointerEvents = 'none';
          shadowRoot.host.style.overflow = 'visible';
        }

        const parent = container.parentElement;
        if (parent) {
          parent.style.position = 'fixed';
          parent.style.inset = '0';
          parent.style.zIndex = '2147483647';
          parent.style.width = '0';
          parent.style.height = '0';
          parent.style.display = 'block';
          parent.style.pointerEvents = 'none';
          parent.style.overflow = 'visible';
        }
        container.style.display = 'block';
        container.style.width = '0';
        container.style.height = '0';
        container.style.pointerEvents = 'none';
        container.style.overflow = 'visible';
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
