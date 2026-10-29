// Registers resolve.mjs before a bench script runs: node --import ./bench/register.mjs bench/<script>.ts
import { register } from 'node:module'

register('./resolve.mjs', import.meta.url)
