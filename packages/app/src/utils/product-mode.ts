export type ProductMode = "base" | "programming" | "legal" | "marxism"

export type ProductModeOption = {
  value: ProductMode
  labelKey: string
  descriptionKey: string
}

export const MODE_OPTIONS: ProductModeOption[] = [
  {
    value: "base",
    labelKey: "settings.mode.option.base.title",
    descriptionKey: "settings.mode.option.base.description",
  },
  {
    value: "programming",
    labelKey: "settings.mode.option.programming.title",
    descriptionKey: "settings.mode.option.programming.description",
  },
  {
    value: "legal",
    labelKey: "settings.mode.option.legal.title",
    descriptionKey: "settings.mode.option.legal.description",
  },
  {
    value: "marxism",
    labelKey: "settings.mode.option.marxism.title",
    descriptionKey: "settings.mode.option.marxism.description",
  },
]

