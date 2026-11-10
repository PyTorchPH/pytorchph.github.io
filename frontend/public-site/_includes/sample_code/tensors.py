import torch

x = torch.tensor([[1.0, 2.0], [3.0, 4.0]])
y = torch.ones(2, 2)

print(x + y)          # element-wise addition
print(x @ y)          # matrix multiplication
print(x.mean(), x.shape)

# Use a GPU or other accelerator (CUDA, Apple MPS, ...) when one is available.
device = torch.accelerator.current_accelerator() if torch.accelerator.is_available() else "cpu"
x = x.to(device)
print(x.device)
