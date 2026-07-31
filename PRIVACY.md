# Privacy policy

XMD is a local-first Markdown editor. Documents opened or created with XMD,
unsaved drafts, workspace paths, and application settings are stored on the
user's device. XMD does not upload document contents, drafts, workspace paths,
or settings to the project maintainers.

## Network access

XMD connects to networked systems only for the following features:

- On startup, and when the user manually checks for updates, XMD requests the
  public release manifest hosted in the XMD source repository.
- When the user chooses to download an update, XMD accesses the download URL
  listed in that release manifest. If the URL represents a web page, XMD opens
  it in the user's default browser instead.
- Links explicitly opened by the user are passed to the user's default system
  application.

These requests necessarily disclose standard connection information, such as
the user's IP address and user-agent information, to the relevant hosting
provider. The project does not add analytics or advertising identifiers to
these requests.

## Third-party services

Update metadata and release files may be hosted by GitHub, CNB, or another
download provider identified in the public release manifest. Those providers
process connection information according to their own privacy policies.

## Changes

Material changes to this policy will be published in this repository. Questions
or privacy concerns can be reported through the project's public issue tracker:
<https://github.com/mr-dadong/x-markdown/issues>.
