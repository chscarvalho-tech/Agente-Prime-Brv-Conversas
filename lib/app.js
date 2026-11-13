import path from 'node:path';
import { Config } from './config.js';
import { Memoria } from './memoria.js';
import { Cerebro } from './cerebro.js';
import { criarCrm } from './crm.js';
import { WaAkg } from './waakg.js';
import { Motor } from './motor.js';

export function carregarEnv(raiz) {
  try { process.loadEnvFile(path.join(raiz, '.env')); } catch { /* sem .env: usa o ambiente */ }
}

export async function criarApp({ raiz, arquivoBanco, crmEmSimulacao = false, cerebro, crm, wa } = {}) {
  const config = new Config(raiz);
  const memoria = new Memoria(arquivoBanco ?? path.join(raiz, 'data', 'agente.db'));
  const motor = new Motor({
    memoria,
    config,
    cerebro: cerebro ?? new Cerebro({ raiz }),
    crm: crm ?? await criarCrm(config.crm(), raiz),
    wa: wa ?? new WaAkg({ url: process.env.WAAKG_URL, apiKey: process.env.WAAKG_API_KEY, sessao: process.env.WAAKG_SESSION }),
    crmEmSimulacao,
  });
  return { config, memoria, motor, crm: motor.crm, wa: motor.wa };
}
