import torch
from torch import nn

# Learn y = 3x + 2 from noisy samples.
torch.manual_seed(0)
x = torch.rand(256, 1)
y = 3 * x + 2 + 0.05 * torch.randn(256, 1)

model = nn.Linear(1, 1)
optimizer = torch.optim.SGD(model.parameters(), lr=0.5)
loss_fn = nn.MSELoss()

for epoch in range(200):
    optimizer.zero_grad()
    loss = loss_fn(model(x), y)
    loss.backward()
    optimizer.step()

print(f"weight={model.weight.item():.2f} bias={model.bias.item():.2f} loss={loss.item():.4f}")
