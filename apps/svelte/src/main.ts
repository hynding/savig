import { mount } from 'svelte';
import '@savig/theme/tokens.css';
import '@savig/theme/global.css';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

export default app;
