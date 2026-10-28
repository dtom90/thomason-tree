declare module 'family-chart' {
  export interface Datum {
    id: string
    data: {
      gender: 'M' | 'F'
      [key: string]: unknown
    }
    rels: {
      parents?: string[]
      spouses?: string[]
      children?: string[]
    }
    [key: string]: unknown
  }

  export type Data = Datum[]

  export class CardHtml {
    setCardDisplay(fields: string[][]): CardHtml
  }

  export class EditTree {
    exportData(): Data
    getDataJson(): string
    open(datum: Datum | undefined): EditTree
    setFields(fields: string[]): EditTree
    setEditFirst(editFirst: boolean): EditTree
    setCardClickOpen(card: CardHtml): EditTree
    setOnChange(fn: () => void): EditTree
  }

  export class Chart {
    setTransitionTime(ms: number): Chart
    setCardXSpacing(n: number): Chart
    setCardYSpacing(n: number): Chart
    setCardHtml(): CardHtml
    editTree(): EditTree
    updateTree(props: { initial?: boolean }): void
    getMainDatum(): Datum | undefined
  }

  export function createChart(cont: HTMLElement | string, data: Data): Chart

  const f3: {
    createChart: typeof createChart
  }

  export default f3
}
