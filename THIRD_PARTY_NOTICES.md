# Third-party notices

## Google AI Edge Gallery

Parts of Glossos are adapted from [Google AI Edge Gallery](https://github.com/google-ai-edge/gallery)
(commit `eb83265`, November 2026), licensed under the Apache License, Version 2.0.

Copyright 2025 Google LLC

Adapted material (each file says what it was ported from and what changed):

| Glossos file | Gallery source |
|---|---|
| `services/lensTeacher/prompts.ts` | `customtasks/xrlanguageteacher/models/XrLanguageTeacherPersona.kt`, `viewmodels/XrLanguageTeacherModelController.kt`, `models/XrLanguageTeacherResponseSchema.kt` |
| `services/lensTeacher/dialogue.ts` | `models/XrLanguageTeacherDialogueFormatter.kt`, `XrLanguageTeacherVocabCardSanitizer.kt`, `XrLanguageTeacherCardDecision.kt` |
| `services/lensTeacher/phrases.ts` | `spokenphrases/XrLanguageTeacherSpokenPhrases.kt` |
| `services/speechMatch.ts` | `models/XrLanguageTeacherSpeechMatcher.kt` (simplified) |
| `components/lens/useLensLesson.ts` | `viewmodels/XrLanguageTeacherLessonController.kt` (behaviour, rewritten for React) |

Licensed under the Apache License, Version 2.0 (the "License"); you may not use these files except in
compliance with the License. You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is
distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and limitations under the License.
