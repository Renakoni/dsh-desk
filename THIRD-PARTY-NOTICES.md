# Third-Party Notices

This file supplements the [MIT License](LICENSE). The MIT License applies to
original DSH Desk source code unless a file or notice says otherwise. The
third-party assets and code listed below are not relicensed by the root MIT
License. Their original owners and terms remain in force.

## Bundled Pet Assets

### Yuexinmiao / 月薪喵

- **Asset:** `src/main/assets/pets/yuexinmiao/spritesheet.webp`
- **Source listing:** [Codex Pet Gallery: yuexinmiao](https://codex-pet.org/pets/yuexinmiao)
- **Catalog API record:** [yuexinmiao metadata](https://codex-pet.org/api/pets/yuexinmiao)
- **Catalog creator:** `shizzhang0`
- **Install command:** `npx codex-pet-installer add yuexinmiao`

The bundled spritesheet is an unmodified copy of the package currently served
by the source listing, verified on 2026-08-24. The catalog record does not
declare an MIT or other separate asset license. Use and redistribution remain
subject to the uploader's rights and the [Codex Pets terms](https://codex-pet.org/terms/).
This notice does not grant additional rights.

### Maid-DeepSeek-Whale

- **Assets:** `src/main/assets/pets/maid-deepseek-whale/`
- **Source API record:** [Codex Pets: maid-deepseek-whale](https://codex-pets.net/api/pets/maid-deepseek-whale)
- **Catalog creator:** `DeaDumB`
- **Install command:** `npx codex-pets add maid-deepseek-whale`

The bundled package is an unmodified copy of the package currently served by
the source API, verified on 2026-08-24. The catalog record does not declare an
MIT or other separate asset license. Use and redistribution remain subject to
the uploader's rights and the [Codex Pets terms](https://codex-pets.net/#/terms).
This notice does not grant additional rights.

### Minato Aqua

- **Assets:** `src/renderer/assets/pet/` and `src/renderer/assets/themes/minato-aqua-cover.png`
- **Character rights:** COVER Corp. and the respective creators
- **Terms:** [hololive derivative works guidelines](https://hololivepro.com/terms/)

The built-in Aqua artwork is fan-made derivative work and is intended for
non-commercial use. It is not covered by the root MIT License.

## Adapted Source Code

### cc-switch

The following files contain adapted provider icon inference and provider preset
data from [farion1231/cc-switch](https://github.com/farion1231/cc-switch):

- `src/renderer/clawd-migrated/components/dsh-routing/iconInference.ts`
- `src/renderer/clawd-migrated/components/dsh-routing/legacyPresets.ts`

The upstream project is released under the MIT License, copyright (c) 2025
Jason Young. The relevant provider icon and preset data remains subject to that
license.

### Clawd Companion

Parts of the interface and event pipeline evolved from
[Clawd Companion](https://github.com/Doulor/Clawd-Companion), released under the
MIT License, copyright © Doulor. The upstream license applies to the portions
derived from that project.

## Upstream Protocols and Formats

- **DeepSeek Harness:** DSH event, plugin, and approval terminology follows
  [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).
- **Codex Pets:** pet package conventions and gallery integrations follow the
  [Codex Pet Gallery](https://codex-pet.org/) and the related
  [OpenAI Pets documentation](https://learn.chatgpt.com/docs/pets).

These references do not make third-party services, characters, or artwork part
of the DSH Desk MIT-licensed source code.

## Dependency Licenses

Runtime and development dependencies retain the licenses declared by their own
packages and lockfiles. This file does not replace those package-level notices.

## cc-switch MIT License

For the adapted cc-switch portions listed above:

```text
MIT License

Copyright (c) 2025 Jason Young

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
