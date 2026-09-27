import torch

w = torch.tensor(2.0, requires_grad=True)
x = torch.tensor(3.0)

loss = (w * x - 1.0) ** 2   # a tiny squared-error loss
loss.backward()             # compute d(loss)/dw automatically

print(loss.item())          # 25.0
print(w.grad)               # tensor(30.)
