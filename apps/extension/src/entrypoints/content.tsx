import { defineContentScript } from 'wxt/sandbox';
import { createShadowRootUi } from 'wxt/client';
import ReactDOM from 'react-dom/client';
import React from 'react';
import App from '../components/App';
import '../assets/tailwind.css';

export default defineContentScript({
  matches: ['*://*.polymarket.com/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    console.log('PolyBTC Terminal: Content script injected and running!');
    const ui = await createShadowRootUi(ctx, {
      name: 'polymarket-btc-terminal',
      position: 'overlay',
      zIndex: 9999,
      onMount: (container) => {
        const root = ReactDOM.createRoot(container);
        root.render(<App />);
        return root;
      },
      onRemove: (root) => {
        if (root) {
          root.unmount();
        }
      },
    });

    ui.mount();

    // Logic to extract slug from URL and fetch market info
    const extractSlug = () => {
      const match = window.location.pathname.match(/^\/event\/([^/]+)/);
      return match ? match[1] : null;
    };

    const subscribeToMarket = async () => {
      const slug = extractSlug();
      if (!slug) return;
      
      try {

        const res = await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`);
        const data = await res.json();
        if (data && data.length > 0 && data[0].markets && data[0].markets.length > 0) {
          const market = data[0].markets[0];
          const conditionId = market.conditionId;
          const tokens = market.clobTokenIds ? JSON.parse(market.clobTokenIds) : market.tokens;
          const yesTokenId = Array.isArray(tokens) ? tokens[0]?.token_id || tokens[0] : null;
          const noTokenId = Array.isArray(tokens) ? tokens[1]?.token_id || tokens[1] : null;
          
          if (conditionId && yesTokenId && noTokenId) {
            chrome.runtime.sendMessage({
              type: 'SEND_WS',
              payload: {
                type: 'SUBSCRIBE_MARKET',
                payload: {
                  conditionId,
                  yesTokenId,
                  noTokenId
                }
              }
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch market data:', err);
      }
    };

    subscribeToMarket();
    // Optional: add a listener for URL changes if it's a SPA
    let lastUrl = location.href;
    new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        subscribeToMarket();
      }
    }).observe(document, {subtree: true, childList: true});
  },
});
