export type CodeBlockStyleId = 'mac' | 'terminal' | 'paper' | 'midnight'

export interface CodeBlockStyle {
  id: CodeBlockStyleId
  name: string
  description: string
  headerClass: string
  headerTextClass: string
  headerControlClass: string
  headerHoverClass: string
  menuClass: string
  menuSearchClass: string
  menuOptionClass: string
  menuSelectedClass: string
  preClass: string
  codeClass: string
  tokenClass: string
  previewHeaderClass: string
  previewBodyClass: string
  previewLineClasses: string[]
}

/*
 * 每套代码块外观集中在这里管理。
 * 新增样式时只需补充一项配置，设置选择器和编辑区会自动同步。
 */
export const codeBlockStyles: CodeBlockStyle[] = [
  {
    id: 'mac',
    name: '经典窗口',
    description: '熟悉的桌面代码窗口',
    headerClass: 'border-[#d4d4d4] bg-[#eeeeee] dark:border-[#414349] dark:bg-[#303238]',
    headerTextClass: 'text-[#55585f] dark:text-[#c4c7ce]',
    headerControlClass: 'text-[#62666d] dark:text-[#b7bac1]',
    headerHoverClass: 'hover:bg-[#dedede] hover:text-[#202124] dark:hover:bg-[#414349] dark:hover:text-white',
    menuClass: 'border-[#c9c9c9] bg-[#eeeeee] text-[#55585f] dark:border-[#414349] dark:bg-[#303238] dark:text-[#c4c7ce]',
    menuSearchClass: 'border-[#c9c9c9] bg-[#f7f7f7] focus-within:border-[#777b83] dark:border-[#494c53] dark:bg-[#27292e] dark:focus-within:border-[#8b9099]',
    menuOptionClass: 'hover:bg-[#dedede] hover:text-[#202124] focus-visible:bg-[#dedede] dark:hover:bg-[#414349] dark:hover:text-white dark:focus-visible:bg-[#414349]',
    menuSelectedClass: 'bg-[#d8d8d8] font-medium text-[#202124] dark:bg-[#414349] dark:text-white',
    preClass: '!border-[#3b3e45] !bg-[#24262b]',
    codeClass: '!text-[#d8dee9]',
    tokenClass: '[&_.hljs-attr]:!text-[#5dd8ff] [&_.hljs-built_in]:!text-[#5dd8ff] [&_.hljs-comment]:!text-[#6c7986] [&_.hljs-keyword]:!text-[#fc5fa3] [&_.hljs-literal]:!text-[#d0bf69] [&_.hljs-number]:!text-[#d0bf69] [&_.hljs-quote]:!text-[#6c7986] [&_.hljs-string]:!text-[#fc6a5d] [&_.hljs-title]:!text-[#67b7a4] [&_.hljs-type]:!text-[#5dd8ff]',
    previewHeaderClass: 'bg-[#eeeeee]',
    previewBodyClass: 'bg-[#24262b]',
    previewLineClasses: ['bg-[#fc5fa3]', 'bg-[#5dd8ff]', 'bg-[#67b7a4]'],
  },
  {
    id: 'terminal',
    name: '终端绿',
    description: '高对比度的命令行质感',
    headerClass: 'border-[#31463a] bg-[#18261e]',
    headerTextClass: 'text-[#a9c9b3]',
    headerControlClass: 'text-[#8eb69a]',
    headerHoverClass: 'hover:bg-[#263b2e] hover:text-[#e1f3e6]',
    menuClass: 'border-[#31463a] bg-[#18261e] text-[#a9c9b3]',
    menuSearchClass: 'border-[#3d5748] bg-[#101a14] focus-within:border-[#8eb69a]',
    menuOptionClass: 'hover:bg-[#263b2e] hover:text-[#e1f3e6] focus-visible:bg-[#263b2e]',
    menuSelectedClass: 'bg-[#263b2e] font-medium text-[#e1f3e6]',
    preClass: '!border-[#31463a] !bg-[#101a14]',
    codeClass: '!text-[#c7e4ce]',
    tokenClass: '[&_.hljs-attr]:!text-[#8dd7a2] [&_.hljs-built_in]:!text-[#7ecf98] [&_.hljs-comment]:!text-[#66806d] [&_.hljs-keyword]:!text-[#b7e07e] [&_.hljs-literal]:!text-[#e0c77e] [&_.hljs-number]:!text-[#e0c77e] [&_.hljs-quote]:!text-[#66806d] [&_.hljs-string]:!text-[#a6d8b3] [&_.hljs-title]:!text-[#63c68a] [&_.hljs-type]:!text-[#8dd7a2]',
    previewHeaderClass: 'bg-[#18261e]',
    previewBodyClass: 'bg-[#101a14]',
    previewLineClasses: ['bg-[#b7e07e]', 'bg-[#63c68a]', 'bg-[#e0c77e]'],
  },
  {
    id: 'paper',
    name: '纸张浅色',
    description: '适合明亮环境与长时间阅读',
    headerClass: 'border-[#d7d2c8] bg-[#eeeae1]',
    headerTextClass: 'text-[#635f56]',
    headerControlClass: 'text-[#706b61]',
    headerHoverClass: 'hover:bg-[#ded8cc] hover:text-[#292720]',
    menuClass: 'border-[#d7d2c8] bg-[#eeeae1] text-[#635f56]',
    menuSearchClass: 'border-[#c9c2b5] bg-[#faf8f2] focus-within:border-[#706b61]',
    menuOptionClass: 'hover:bg-[#ded8cc] hover:text-[#292720] focus-visible:bg-[#ded8cc]',
    menuSelectedClass: 'bg-[#ded8cc] font-medium text-[#292720]',
    preClass: '!border-[#d7d2c8] !bg-[#faf8f2]',
    codeClass: '!text-[#34322d]',
    tokenClass: '[&_.hljs-attr]:!text-[#006a83] [&_.hljs-built_in]:!text-[#006a83] [&_.hljs-comment]:!text-[#8b877d] [&_.hljs-keyword]:!text-[#9f2254] [&_.hljs-literal]:!text-[#805b00] [&_.hljs-number]:!text-[#805b00] [&_.hljs-quote]:!text-[#8b877d] [&_.hljs-string]:!text-[#a13b27] [&_.hljs-title]:!text-[#26715d] [&_.hljs-type]:!text-[#006a83]',
    previewHeaderClass: 'bg-[#eeeae1]',
    previewBodyClass: 'bg-[#faf8f2]',
    previewLineClasses: ['bg-[#9f2254]', 'bg-[#006a83]', 'bg-[#26715d]'],
  },
  {
    id: 'midnight',
    name: '午夜蓝',
    description: '冷静、清晰的深蓝配色',
    headerClass: 'border-[#283a55] bg-[#1d2b40]',
    headerTextClass: 'text-[#b7c7de]',
    headerControlClass: 'text-[#9eb3d0]',
    headerHoverClass: 'hover:bg-[#2b3e5b] hover:text-white',
    menuClass: 'border-[#283a55] bg-[#1d2b40] text-[#b7c7de]',
    menuSearchClass: 'border-[#385071] bg-[#111b2b] focus-within:border-[#82aaff]',
    menuOptionClass: 'hover:bg-[#2b3e5b] hover:text-white focus-visible:bg-[#2b3e5b]',
    menuSelectedClass: 'bg-[#2b3e5b] font-medium text-white',
    preClass: '!border-[#283a55] !bg-[#111b2b]',
    codeClass: '!text-[#d2dced]',
    tokenClass: '[&_.hljs-attr]:!text-[#77c7d9] [&_.hljs-built_in]:!text-[#77c7d9] [&_.hljs-comment]:!text-[#64758e] [&_.hljs-keyword]:!text-[#c792ea] [&_.hljs-literal]:!text-[#f0c674] [&_.hljs-number]:!text-[#f0c674] [&_.hljs-quote]:!text-[#64758e] [&_.hljs-string]:!text-[#c3e88d] [&_.hljs-title]:!text-[#82aaff] [&_.hljs-type]:!text-[#89ddff]',
    previewHeaderClass: 'bg-[#1d2b40]',
    previewBodyClass: 'bg-[#111b2b]',
    previewLineClasses: ['bg-[#c792ea]', 'bg-[#77c7d9]', 'bg-[#c3e88d]'],
  },
]

export const getCodeBlockStyle = (styleId: CodeBlockStyleId): CodeBlockStyle =>
  codeBlockStyles.find((style) => style.id === styleId) ?? codeBlockStyles[0]
