import torch

x = torch.tensor([[1.0, 2.0], [3.0, 4.0]])
y = torch.ones(2, 2)

print(x + y)          # element-wise addition
print(x @ y)          # matrix multiplication
print(x.mean(), x.shape)

device = "cuda" if torch.cuda.is_available() else "cpu"
x = x.to(device)      # move to a GPU when one is available
print(x.device)
