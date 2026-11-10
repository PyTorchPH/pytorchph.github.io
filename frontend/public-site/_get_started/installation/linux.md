# Installing on Linux
{:.no_toc}

PyTorch can be installed and used on various Linux distributions. Depending on your system and compute requirements, your experience with PyTorch on Linux may vary in terms of processing time. It is recommended, but not required, that your Linux system has an NVIDIA or AMD GPU in order to harness the full power of PyTorch's [CUDA](https://developer.nvidia.com/cuda-zone) [support](https://pytorch.org/tutorials/beginner/blitz/tensor_tutorial.html?highlight=cuda#cuda-tensors) or [ROCm](https://rocm.docs.amd.com/) support.

## Prerequisites
{: #linux-prerequisites}

### Supported Linux Distributions

Prebuilt PyTorch 2.15 packages target Linux distributions that use [glibc](https://www.gnu.org/software/libc/) 2.28 or newer (the `manylinux_2_28` standard), on x86-64 and ARM64 (aarch64). Examples include:

* [Ubuntu](https://ubuntu.com/download/desktop) 20.04 or newer
* [Debian](https://www.debian.org/distrib/) 10 or newer
* [Fedora](https://fedoraproject.org/) 29 or newer
* Red Hat Enterprise Linux, Rocky Linux, or AlmaLinux 8 or newer

Check your glibc version with `ldd --version`.

> The install instructions here will generally apply to all supported Linux distributions. An example difference is that your distribution may support `yum` instead of `apt`. The examples use `apt` on Ubuntu.

### Python
{: #linux-python}

PyTorch 2.15 supports Python 3.11 to 3.15. Check your version with `python3 --version`. If your distribution ships an older Python, install a newer one with your package manager or a tool such as [uv](https://docs.astral.sh/uv/).

> Tip: By default, you will have to use the command `python3` to run Python. If you want to use just the command `python`, instead of `python3`, you can symlink `python` to the `python3` binary.

However, if you want to install another version, there are multiple ways:

* APT
* [Python website](https://www.python.org/downloads/mac-osx/)

If you decide to use APT, you can run the following command to install it:

```bash
sudo apt install python
```

### Package Manager
{: #linux-package-manager}

To install the PyTorch binaries, you will need to use the supported package manager: [pip](https://pypi.org/project/pip/).
#### pip

*Python 3*

While Python 3.x is installed by default on Linux, `pip` is not installed by default.

```bash
sudo apt install python3-pip
```

> Tip: If you want to use just the command  `pip`, instead of `pip3`, you can symlink `pip` to the `pip3` binary.

## Installation
{: #linux-installation}

### pip
{: #linux-pip}

#### No CUDA

To install PyTorch via pip, and do not have a [CUDA-capable](https://developer.nvidia.com/cuda-zone) or [ROCm-capable](https://rocm.docs.amd.com/) system or do not require CUDA/ROCm (i.e. GPU support), in the above selector, choose OS: Linux, Package: Pip, Language: Python and Compute Platform: CPU.
Then, run the command that is presented to you.

#### With CUDA

To install PyTorch via pip, and do have a [CUDA-capable](https://developer.nvidia.com/cuda-zone) system, in the above selector, choose OS: Linux, Package: Pip, Language: Python and the CUDA version suited to your machine. Often, the latest CUDA version is better.
Then, run the command that is presented to you.

#### With ROCm

To install PyTorch via pip, and do have a [ROCm-capable](https://rocm.docs.amd.com/) system, in the above selector, choose OS: Linux, Package: Pip, Language: Python and the ROCm version supported.
Then, run the command that is presented to you.

## Verification
{: #linux-verification}

To ensure that PyTorch was installed correctly, we can verify the installation by running sample PyTorch code. Here we will construct a randomly initialized tensor.


```python
import torch
x = torch.rand(5, 3)
print(x)
```

The output should be something similar to:

```
tensor([[0.3380, 0.3845, 0.3217],
        [0.8337, 0.9050, 0.2650],
        [0.2979, 0.7141, 0.9069],
        [0.1449, 0.1132, 0.1375],
        [0.4675, 0.3947, 0.1426]])
```

Additionally, to check if your GPU driver and CUDA/ROCm is enabled and accessible by PyTorch, run the following commands to return whether or not the GPU driver is enabled (the ROCm build of PyTorch uses the same semantics at the python API level [link](https://github.com/pytorch/pytorch/blob/master/docs/source/notes/hip.rst#hip-interfaces-reuse-the-cuda-interfaces), so the below commands should also work for ROCm):

```python
import torch
torch.cuda.is_available()
```

## Building from source
{: #linux-from-source}

For the majority of PyTorch users, installing from a pre-built binary via a package manager will provide the best experience. However, there are times when you may want to install the bleeding edge PyTorch code, whether for testing or actual development on the PyTorch core. To install the latest PyTorch code, you will need to [build PyTorch from source](https://github.com/pytorch/pytorch#from-source).

### Prerequisites
{: #linux-prerequisites-2}

1. Install [Pip](#pip)
2. If you need to build PyTorch with GPU support
   a. for NVIDIA GPUs, install [CUDA](https://developer.nvidia.com/cuda-downloads), if your machine has a [CUDA-enabled GPU](https://developer.nvidia.com/cuda-gpus).
   b. for AMD GPUs, install [ROCm](https://rocm.docs.amd.com/), if your machine has a [ROCm-enabled GPU](https://rocm.docs.amd.com/)
3. Follow the steps described here: [https://github.com/pytorch/pytorch#from-source](https://github.com/pytorch/pytorch#from-source)

You can verify the installation as described [above](#linux-verification).
