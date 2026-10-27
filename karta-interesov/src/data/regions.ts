/**
 * Регионы Казахстана для будущей региональной аналитики.
 * Список: 17 областей и 3 города республиканского значения (после административной реформы 2022 года).
 * Перед использованием в backend сверьте его с официальным классификатором (КАТО) —
 * коды ниже — внутренние идентификаторы проекта, а не государственные коды.
 * Сейчас интерфейс регион не запрашивает: для этого нужен отдельный шаг в UI.
 */
export interface Region {
  code: string;
  name: string;
  kind: 'region' | 'city';
}

export const REGIONS: Region[] = [
  { code: 'abai',             name: 'Абайская область',               kind: 'region' },
  { code: 'akmola',           name: 'Акмолинская область',            kind: 'region' },
  { code: 'aktobe',           name: 'Актюбинская область',            kind: 'region' },
  { code: 'almaty-region',    name: 'Алматинская область',            kind: 'region' },
  { code: 'atyrau',           name: 'Атырауская область',             kind: 'region' },
  { code: 'east-kazakhstan',  name: 'Восточно-Казахстанская область', kind: 'region' },
  { code: 'zhambyl',          name: 'Жамбылская область',             kind: 'region' },
  { code: 'jetisu',           name: 'Жетысуская область',             kind: 'region' },
  { code: 'west-kazakhstan',  name: 'Западно-Казахстанская область',  kind: 'region' },
  { code: 'karaganda',        name: 'Карагандинская область',         kind: 'region' },
  { code: 'kostanay',         name: 'Костанайская область',           kind: 'region' },
  { code: 'kyzylorda',        name: 'Кызылординская область',         kind: 'region' },
  { code: 'mangystau',        name: 'Мангистауская область',          kind: 'region' },
  { code: 'pavlodar',         name: 'Павлодарская область',           kind: 'region' },
  { code: 'north-kazakhstan', name: 'Северо-Казахстанская область',   kind: 'region' },
  { code: 'turkistan',        name: 'Туркестанская область',          kind: 'region' },
  { code: 'ulytau',           name: 'Улытауская область',             kind: 'region' },
  { code: 'astana',           name: 'г. Астана',                      kind: 'city' },
  { code: 'almaty-city',      name: 'г. Алматы',                      kind: 'city' },
  { code: 'shymkent',         name: 'г. Шымкент',                     kind: 'city' },
];
