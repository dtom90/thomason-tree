import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import '../../../src/styles/family-chart.css'

mount(App, { target: document.getElementById('app') })
