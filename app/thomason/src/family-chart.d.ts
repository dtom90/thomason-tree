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
    setStyle(style: 'default' | 'imageCircleRect' | 'imageCircle' | 'imageRect' | 'rect'): CardHtml
    setOnCardUpdate(fn: (this: HTMLElement, d: { data: Datum }) => void): CardHtml
  }

  export class EditTree {
    exportData(): Data
    getDataJson(): string
    open(datum: Datum | undefined): EditTree
    setFields(fields: Array<string | { type: string; label: string; id: string }>): EditTree
    setEditFirst(editFirst: boolean): EditTree
    setNoEdit(): EditTree
    setCanEdit(fn: (datum: Datum) => boolean): EditTree
    setCanDelete(fn: (datum: Datum) => boolean): EditTree
    setCanAdd(
      fn: (datum: Datum) => { parent?: boolean; spouse?: boolean; child?: boolean },
    ): EditTree
    setCardClickOpen(card: CardHtml): EditTree
    setOnChange(fn: () => void): EditTree
    setOnDelete(
      fn: (
        datum: Datum,
        deletePerson: () => void,
        postSubmit: (props?: { delete?: boolean }) => void,
      ) => void,
    ): EditTree
    setOnFormCreation(
      fn: (props: { cont: HTMLElement; form_creator: { datum_id: string } }) => void,
    ): EditTree
  }

  export class Chart {
    setTransitionTime(ms: number): Chart
    setCardXSpacing(n: number): Chart
    setCardYSpacing(n: number): Chart
    setCardHtml(): CardHtml
    editTree(): EditTree
    updateTree(props?: { initial?: boolean }): Chart
    updateData(data: Data): Chart
    updateMainId(id: string): Chart
    getMainDatum(): Datum | undefined
  }

  export function createChart(cont: HTMLElement | string, data: Data): Chart

  const f3: {
    createChart: typeof createChart
  }

  export default f3
}
