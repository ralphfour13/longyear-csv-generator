/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

// Shopify Polaris web components
declare namespace JSX {
  interface IntrinsicElements {
    's-app-nav': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    's-link': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { href?: string }, HTMLElement>;
    's-section': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { heading?: string; slot?: string }, HTMLElement>;
    's-banner': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { tone?: string }, HTMLElement>;
    's-page': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { heading?: string }, HTMLElement>;
    's-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { variant?: string; type?: string; href?: string }, HTMLElement>;
    's-text': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    's-stack': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { direction?: string; gap?: string; alignItems?: string }, HTMLElement>;
  }
}
