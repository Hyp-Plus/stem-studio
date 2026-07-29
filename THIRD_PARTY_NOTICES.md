# Third-party notices

Stem Studio is an independent project. “Demucs” and “FFmpeg” are used only to identify compatible third-party software; Stem Studio is not endorsed by, sponsored by, or affiliated with Meta Platforms, Inc., the Demucs project, or the FFmpeg project.

## Demucs

The macOS separation engine includes software based on Demucs.

Copyright (c) Meta Platforms, Inc. and affiliates.

Licensed under the MIT License:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Source: https://github.com/facebookresearch/demucs

## Other engine dependencies

The platform-specific engine is built from Python packages and may include their runtime dependencies, including PyTorch, NumPy, PyInstaller, demucs-onnx, ONNX Runtime and their transitive dependencies. Their exact composition varies by platform and build date.

Each engine build produces `resources/engine/THIRD_PARTY_ENGINE_NOTICES.json`, a dependency inventory containing the corresponding license and notice files where packages provide them. Preserve that file in every installer and do not represent this overview as replacing a dependency’s own license.

## Model weights and user content

Pretrained model weights are downloaded directly from the upstream Demucs host when requested; they are not included in a Stem Studio installer. Their use is subject to the applicable upstream terms.

Users are responsible for ensuring they have all rights needed to process, copy, export, share, or publish any audio or video supplied to Stem Studio. Stem Studio grants no rights in third-party music, recordings, video, or other content.

## FFmpeg

Stem Studio does not include or distribute FFmpeg binaries. If a user installs FFmpeg separately, that user is responsible for the applicable FFmpeg license, source-code obligations, codec patents, and local law. FFmpeg is a trademark of Fabrice Bellard.
