export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'chore',
        'perf',
        'refactor',
        'style',
        'test',
        'docs',
        'ci',
        'build',
        'revert'
      ]
    ],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'scope-case': [2, 'always', 'lower-case'],
    'scope-empty': [2, 'never'],
    'subject-case': [
      2,
      'never',
      ['sentence-case', 'start-case', 'pascal-case', 'upper-case']
    ],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'subject-max-length': [2, 'always', 70],
    'subject-min-length': [2, 'always', 3],
    'header-max-length': [2, 'always', 100],
    'body-leading-blank': [2, 'always'],
    'body-max-line-length': [2, 'always', 100],
    'footer-leading-blank': [2, 'always'],
    'footer-max-line-length': [2, 'always', 100]
  },
  prompt: {
    messages: {
      type: '请选择提交类型:',
      scope: '请输入修改范围 (可选):',
      customScope: '请输入自定义范围:',
      subject: '请输入提交说明:\n',
      body: '请输入详细描述 (可选，可使用 "|" 换行):\n',
      breaking: '请列出任何 BREAKING CHANGES (可选):\n',
      footerPrefixsSelect: '请选择关联issue前缀 (可选):',
      customFooterPrefixs: '请输入自定义issue前缀:',
      footer: '请输入关联issue (可选):\n',
      confirmCommit: '是否提交或修改commit?'
    },
    types: [
      { value: 'feat', name: 'feat:     ✨  新增功能', emoji: '✨' },
      { value: 'fix', name: 'fix:      🐛  修复bug', emoji: '🐛' },
      {
        value: 'chore',
        name: 'chore:    🛠️   其他修改',
        emoji: '🛠️'
      },
      { value: 'perf', name: 'perf:     ⚡️  性能优化', emoji: '⚡️' },
      {
        value: 'refactor',
        name: 'refactor: ♻️   代码重构',
        emoji: '♻️'
      },
      { value: 'style', name: 'style:    🎨  代码格式', emoji: '🎨' },
      {
        value: 'test',
        name: 'test:     🧪  测试',
        emoji: '🧪'
      },
      { value: 'docs', name: 'docs:     📝  文档变更', emoji: '📝' },
      { value: 'ci', name: 'ci:       🚀  CI相关', emoji: '🚀' },
      { value: 'build', name: 'build:    📦  构建相关', emoji: '📦' },
      { value: 'revert', name: 'revert:   ⏪  回退提交', emoji: '⏪' }
    ],
    useEmoji: true,
    themeColorCode: '',
    scopes: [
      { value: 'base', name: 'base:               整个项目' },
      { value: 'front-end', name: 'front-end:          前端部分' },
      { value: 'back-end', name: 'back-end:           Rust部分' }
    ],
    allowCustomScopes: true,
    allowEmptyScopes: true,
    customScopesAlign: 'bottom',
    customScopesAlias: '自定义',
    emptyScopesAlias: '跳过',
    upperCaseSubject: false,
    allowBreakingChanges: ['feat', 'fix'],
    breaklineNumber: 100,
    breaklineChar: '|',
    skipQuestions: [],
    issuePrefixs: [
      { value: 'closed', name: 'closed:   ISSUES has been processed' }
    ],
    customIssuePrefixsAlign: 'top',
    emptyIssuePrefixsAlias: '跳过',
    customIssuePrefixsAlias: '自定义',
    allowCustomIssuePrefixs: true,
    allowEmptyIssuePrefixs: true,
    confirmColorize: true,
    maxHeaderLength: Infinity,
    maxSubjectLength: Infinity,
    minSubjectLength: 0,
    scopeOverrides: undefined,
    defaultBody: '',
    defaultIssues: '',
    defaultScope: '',
    defaultSubject: ''
  }
}
