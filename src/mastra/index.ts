import { resolve } from 'node:path';
import { Mastra } from '@mastra/core/mastra';
import { MastraEditor } from '@mastra/editor';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import {
  Observability,
  DefaultExporter,
  SensitiveDataFilter,
} from '@mastra/observability';

// Absoluter Pfad relativ zum Projekt-Root, damit `next dev` und `mastra dev`
// (die aus unterschiedlichen Working-Directories starten) dieselbe DB nutzen.
const dbPath = resolve(process.cwd(), 'mastra.db');

export const mastra = new Mastra({
  agents: {},
  workflows: {},
  scorers: {},
  editor: new MastraEditor(),
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: `file:${dbPath}`,
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new DefaultExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
