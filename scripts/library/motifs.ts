// Motive der mitgelieferten Bibliothek (Quellen nach Gruppen in motifs-*.ts)
import type { Def } from './defs';
import { ANIMALS } from './motifs-animals';
import { NATURE } from './motifs-nature';
import { THINGS } from './motifs-things';

export const MOTIFS: Def[] = [...ANIMALS, ...NATURE, ...THINGS];
