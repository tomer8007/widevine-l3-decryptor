# Widevine L3 Decryptor
[Widevine](https://www.widevine.com/solutions/widevine-drm) is a Google-owned DRM system that's in use by many popular streaming services (Netflix, Spotify, etc.) to prevent media content from being downloaded.

But Widevine's least secure security level, L3, as used in most browsers and PCs, is implemented 100% in software (i.e no hardware TEEs), thereby making it reversible and bypassable.

This Chrome extension demonstrates how it's possible to bypass Widevine DRM by hijacking calls to the browser's [Encrypted Media Extensions (EME)](https://www.html5rocks.com/en/tutorials/eme/basics) and decrypting all Widevine content keys transferred - effectively turning it into a clearkey DRM.

## Usage
To see this concept in action, just load the extension in Developer Mode and browse to any website that plays Widevine-protected content, such as https://bitmovin.com/demos/drm _[Update: link got broken?]_.

Keys will be logged in plaintext to the javascript console.

e.g:

```
WidevineDecryptor: Found key: 100b6c20940f779a4589152b57d2dacb (KID=eb676abbcb345e96bbcf616630f1a3da)
```

Decrypting the media itself is then just a matter of using a tool that can decrypt MPEG-CENC streams, like `ffmpeg`. 

e.g:

```
ffmpeg -decryption_key 100b6c20940f779a4589152b57d2dacb -i encrypted_media.mp4 -codec copy decrypted_media.mp4
```
**NOTE**: The extension currently supports the Windows platform only.

## How
In the context of browsers the actual decryption of the media is usually done inside a proprietary binary (`widevinecdm.dll`, known as the Content Decryption Module or CDM) only after receiving the license from a license server with an encrypted key in it.

This binary is usually heavily obfuscated and makes use of third-party solutions that claim to offer software "protection" such as [Arxan](https://digital.ai/application-protection) or [Whitecryption](https://www.intertrust.com/products/application-shielding).

Some reversing job on that binary can then be done to extract the secret keys and mimic the key decryption algorithm from the license response.

## Why
This PoC was done to further show that code obfuscation, anti-debugging tricks, whitebox cryptography algorithms and other methods of security-by-obscurity will eventually by defeated anyway, and are, in a way, pointless.

## Legal Disclaimer
This is for educational purposes only. Downloading copyrighted materials from streaming services may violate their Terms of Service. **Use at your own risk.**
